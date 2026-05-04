#!/usr/bin/env python3

"""Convert AMSA vessel-track shapefiles to a filtered GeoJSON FeatureCollection.

This utility is intentionally source-specific: it understands the AMSA monthly
archive layout used by `Vessel Traffic Data March 2026.zip`, extracts the
contained point shapefile, and writes a GeoJSON subset using a radius filter.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import tempfile
import zipfile

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    from pyogrio import raw as pyogrio_raw  # type: ignore
except ImportError:
    pyogrio_raw = None

try:
    import shapefile  # type: ignore
except ImportError:
    shapefile = None


ADELAIDE_LAT = -34.9285
ADELAIDE_LON = 138.6007
EARTH_RADIUS_KM = 6371.0088
AMSA_FIELDS = [
    "CRAFT_ID",
    "LON",
    "LAT",
    "COURSE",
    "SPEED",
    "TYPE",
    "SUBTYPE",
    "LENGTH",
    "BEAM",
    "DRAUGHT",
    "TIMESTAMP",
]


@dataclass(frozen=True)
class SourcePaths:
    shp: Path
    cleanup_dir: Path | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert AMSA vessel-track shapefile archives to filtered GeoJSON."
    )
    parser.add_argument(
        "input_path",
        type=Path,
        help="AMSA outer zip, inner zip, or extracted .shp path.",
    )
    parser.add_argument(
        "output_path",
        type=Path,
        help="Destination GeoJSON file path.",
    )
    parser.add_argument(
        "--center-lat",
        type=float,
        default=ADELAIDE_LAT,
        help=f"Latitude for the radius filter. Default: Adelaide ({ADELAIDE_LAT}).",
    )
    parser.add_argument(
        "--center-lon",
        type=float,
        default=ADELAIDE_LON,
        help=f"Longitude for the radius filter. Default: Adelaide ({ADELAIDE_LON}).",
    )
    parser.add_argument(
        "--radius-km",
        type=float,
        default=100.0,
        help="Filter radius in kilometers. Default: 100.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print the output GeoJSON for easier inspection.",
    )
    return parser.parse_args()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    delta_lat = lat2_rad - lat1_rad
    delta_lon = lon2_rad - lon1_rad

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return EARTH_RADIUS_KM * c


def bounding_box(center_lat: float, center_lon: float, radius_km: float) -> tuple[float, float, float, float]:
    lat_delta = radius_km / 111.32
    lon_delta = radius_km / (111.32 * math.cos(math.radians(center_lat)))
    return (
        center_lon - lon_delta,
        center_lat - lat_delta,
        center_lon + lon_delta,
        center_lat + lat_delta,
    )


def parse_timestamp(value: str) -> str | None:
    text = value.strip()
    if not text:
        return None

    for pattern in (
        "%d/%m/%Y %I:%M:%S %p",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
    ):
        try:
            parsed = datetime.strptime(text, pattern)
            return parsed.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            continue

    return None


def json_scalar(value: object) -> object:
    if hasattr(value, "item"):
        return value.item()
    return value


def sanitize_json_value(value: object) -> object:
    scalar = json_scalar(value)
    if isinstance(scalar, float) and not math.isfinite(scalar):
        return None
    return scalar


def finite_float(value: object) -> float | None:
    scalar = sanitize_json_value(value)
    if scalar is None:
        return None

    number = float(scalar)
    if not math.isfinite(number):
        return None

    return number


def extract_zip(zip_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(destination)


def resolve_source_paths(input_path: Path) -> SourcePaths:
    if not input_path.exists():
        raise FileNotFoundError(f"Input path does not exist: {input_path}")

    if input_path.suffix.lower() == ".shp":
        return SourcePaths(shp=input_path)

    if input_path.suffix.lower() != ".zip":
        raise ValueError(f"Unsupported input type: {input_path}")

    temp_dir = Path(tempfile.mkdtemp(prefix="amsa-vessel-tracks-"))
    extract_zip(input_path, temp_dir)

    nested_zip_paths = sorted(temp_dir.rglob("*.zip"))
    if nested_zip_paths:
        nested_dir = temp_dir / "_nested"
        nested_dir.mkdir(exist_ok=True)
        extract_zip(nested_zip_paths[0], nested_dir)
        shp_paths = sorted(nested_dir.rglob("*.shp"))
    else:
        shp_paths = sorted(temp_dir.rglob("*.shp"))

    if not shp_paths:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise FileNotFoundError(f"No .shp file found in archive: {input_path}")

    return SourcePaths(shp=shp_paths[0], cleanup_dir=temp_dir)


def build_feature(properties: dict[str, object], lon: float, lat: float) -> dict[str, object]:
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],
        },
        "properties": properties,
    }


def open_geojson_writer(
    output_path: Path,
    center_lat: float,
    center_lon: float,
    radius_km: float,
    pretty: bool,
):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    indent = 2 if pretty else None
    separators = (",", ": ") if pretty else (",", ":")
    header = {
        "type": "FeatureCollection",
        "name": output_path.stem,
        "source": {
            "format": "ESRI Shapefile",
            "schema": "AMSA CTS vessel tracking dataset",
            "radiusKm": radius_km,
            "center": {"lat": center_lat, "lon": center_lon},
        },
    }

    handle = output_path.open("w", encoding="utf-8")
    if pretty:
        handle.write("{\n")
        handle.write('  "type": "FeatureCollection",\n')
        handle.write(f'  "name": {json.dumps(header["name"])},\n')
        handle.write(f'  "source": {json.dumps(header["source"], indent=2)},\n')
        handle.write('  "features": [')
    else:
        handle.write(json.dumps(header, separators=separators)[:-1] + ',"features":[')

    return handle, indent, separators, True


def write_feature(
    handle,
    feature: dict[str, object],
    pretty: bool,
    indent: int | None,
    separators,
    first_feature: bool,
) -> bool:
    if not first_feature:
        handle.write(",")

    handle.write("\n  " if pretty else "")
    handle.write(json.dumps(feature, indent=indent, separators=separators, allow_nan=False))
    return False


def close_geojson_writer(handle, pretty: bool) -> None:
    handle.write("\n" if pretty else "")
    handle.write("]}")
    handle.close()


def convert_to_geojson_pyogrio(
    source: SourcePaths,
    output_path: Path,
    center_lat: float,
    center_lon: float,
    radius_km: float,
    pretty: bool,
) -> tuple[int, int]:
    if pyogrio_raw is None:
        raise RuntimeError("pyogrio is not available.")

    meta, _fids, _geom, field_arrays = pyogrio_raw.read(
        str(source.shp),
        columns=AMSA_FIELDS,
        read_geometry=False,
        bbox=bounding_box(center_lat, center_lon, radius_km),
    )
    field_names = [str(name) for name in meta["fields"]]
    missing_fields = [name for name in ("CRAFT_ID", "LON", "LAT", "TIMESTAMP") if name not in field_names]
    if missing_fields:
        raise ValueError(
            f"Input shapefile did not contain expected AMSA fields: {', '.join(missing_fields)}"
        )

    arrays = {field_names[index]: field_arrays[index] for index in range(len(field_names))}
    total_records = len(arrays["LON"])
    kept_records = 0
    handle, indent, separators, first_feature = open_geojson_writer(
        output_path, center_lat, center_lon, radius_km, pretty
    )

    try:
        for index in range(total_records):
            lon = finite_float(arrays["LON"][index])
            lat = finite_float(arrays["LAT"][index])
            if lon is None or lat is None:
                continue
            distance_km = haversine_km(center_lat, center_lon, lat, lon)
            if distance_km > radius_km:
                continue

            kept_records += 1
            timestamp_value = sanitize_json_value(arrays["TIMESTAMP"][index])
            timestamp = str(timestamp_value or "")
            properties = {
                "craftId": sanitize_json_value(arrays["CRAFT_ID"][index]),
                "course": sanitize_json_value(arrays["COURSE"][index]),
                "speedKnots": sanitize_json_value(arrays["SPEED"][index]),
                "type": sanitize_json_value(arrays["TYPE"][index]),
                "subtype": sanitize_json_value(arrays["SUBTYPE"][index]),
                "lengthMeters": sanitize_json_value(arrays["LENGTH"][index]),
                "beamMeters": sanitize_json_value(arrays["BEAM"][index]),
                "draughtMeters": sanitize_json_value(arrays["DRAUGHT"][index]),
                "timestamp": timestamp,
                "timestampIsoUtc": parse_timestamp(timestamp),
                "distanceFromCenterKm": round(distance_km, 3),
            }
            feature = build_feature(properties, lon, lat)
            first_feature = write_feature(
                handle, feature, pretty, indent, separators, first_feature
            )
    finally:
        close_geojson_writer(handle, pretty)

    return total_records, kept_records


def convert_to_geojson_pyshp(
    source: SourcePaths,
    output_path: Path,
    center_lat: float,
    center_lon: float,
    radius_km: float,
    pretty: bool,
) -> tuple[int, int]:
    if shapefile is None:
        raise RuntimeError("pyshp is not available.")

    reader = shapefile.Reader(str(source.shp))
    fields = [field[0] for field in reader.fields[1:]]
    missing_fields = [name for name in ("CRAFT_ID", "LON", "LAT", "TIMESTAMP") if name not in fields]
    if missing_fields:
        raise ValueError(
            f"Input shapefile did not contain expected AMSA fields: {', '.join(missing_fields)}"
        )

    total_records = 0
    kept_records = 0
    handle, indent, separators, first_feature = open_geojson_writer(
        output_path, center_lat, center_lon, radius_km, pretty
    )

    try:
        for shape_record in reader.iterShapeRecords():
            total_records += 1
            record = shape_record.record.as_dict()

            lon_value = record.get("LON")
            lat_value = record.get("LAT")
            lon = finite_float(lon_value if lon_value is not None else shape_record.shape.points[0][0])
            lat = finite_float(lat_value if lat_value is not None else shape_record.shape.points[0][1])
            if lon is None or lat is None:
                continue
            distance_km = haversine_km(center_lat, center_lon, lat, lon)
            if distance_km > radius_km:
                continue

            kept_records += 1
            timestamp = str(record.get("TIMESTAMP") or "")
            properties = {
                "craftId": sanitize_json_value(record.get("CRAFT_ID")),
                "course": sanitize_json_value(record.get("COURSE")),
                "speedKnots": sanitize_json_value(record.get("SPEED")),
                "type": sanitize_json_value(record.get("TYPE")),
                "subtype": sanitize_json_value(record.get("SUBTYPE")),
                "lengthMeters": sanitize_json_value(record.get("LENGTH")),
                "beamMeters": sanitize_json_value(record.get("BEAM")),
                "draughtMeters": sanitize_json_value(record.get("DRAUGHT")),
                "timestamp": timestamp,
                "timestampIsoUtc": parse_timestamp(timestamp),
                "distanceFromCenterKm": round(distance_km, 3),
            }
            feature = build_feature(properties, lon, lat)
            first_feature = write_feature(
                handle, feature, pretty, indent, separators, first_feature
            )
    finally:
        close_geojson_writer(handle, pretty)

    return total_records, kept_records


def convert_to_geojson(
    source: SourcePaths,
    output_path: Path,
    center_lat: float,
    center_lon: float,
    radius_km: float,
    pretty: bool,
) -> tuple[int, int]:
    if pyogrio_raw is not None:
        return convert_to_geojson_pyogrio(
            source, output_path, center_lat, center_lon, radius_km, pretty
        )

    if shapefile is not None:
        return convert_to_geojson_pyshp(
            source, output_path, center_lat, center_lon, radius_km, pretty
        )

    raise SystemExit(
        "Missing GIS reader dependencies. Install one of: "
        "python3 -m pip install pyogrio or python3 -m pip install pyshp"
    )


def main() -> int:
    args = parse_args()
    source = resolve_source_paths(args.input_path)

    try:
        total, kept = convert_to_geojson(
            source=source,
            output_path=args.output_path,
            center_lat=args.center_lat,
            center_lon=args.center_lon,
            radius_km=args.radius_km,
            pretty=args.pretty,
        )
    finally:
        if source.cleanup_dir is not None:
            shutil.rmtree(source.cleanup_dir, ignore_errors=True)

    print(
        json.dumps(
            {
                "input": str(args.input_path),
                "output": str(args.output_path),
                "center": {"lat": args.center_lat, "lon": args.center_lon},
                "radiusKm": args.radius_km,
                "readStrategy": "bbox-prefilter" if pyogrio_raw is not None else "full-scan",
                "recordsRead": total,
                "recordsWritten": kept,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
