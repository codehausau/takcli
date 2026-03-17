import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";

import type { ResolvedProfile } from "../../core/profile-resolution.js";

function ensureValidTlsPair(profile: ResolvedProfile): void {
  const hasCert = Boolean(profile.tls.certFile);
  const hasKey = Boolean(profile.tls.keyFile);

  if (hasCert !== hasKey) {
    throw new Error("Both tls.certFile and tls.keyFile must be configured together.");
  }
}

function describeStreamError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /certificate required|alert certificate required|bad certificate|handshake failure|unknown ca/i.test(
      message
    )
  ) {
    return new Error(
      "The CoT stream rejected the TLS connection. Configure tls.certFile and tls.keyFile if the server requires a client certificate."
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function connectCotSocket(profile: ResolvedProfile, timeoutMs: number): Promise<tls.TLSSocket> {
  ensureValidTlsPair(profile);

  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({
      ca: profile.tls.caFile ? readFileSync(profile.tls.caFile) : undefined,
      cert: profile.tls.certFile ? readFileSync(profile.tls.certFile) : undefined,
      host: profile.host,
      key: profile.tls.keyFile ? readFileSync(profile.tls.keyFile) : undefined,
      port: profile.ports.cot,
      rejectUnauthorized: !profile.tls.insecureSkipVerify,
      servername: net.isIP(profile.host) ? undefined : profile.host
    });

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`CoT TLS connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(describeStreamError(error));
    });
  });
}

export async function sendCotEventXml(
  profile: ResolvedProfile,
  xml: string,
  timeoutMs: number
): Promise<number> {
  const socket = await connectCotSocket(profile, timeoutMs);

  return new Promise<number>((resolve, reject) => {
    socket.write(xml, "utf8", (error) => {
      if (error) {
        socket.destroy();
        reject(describeStreamError(error));
        return;
      }

      const bytesSent = Buffer.byteLength(xml, "utf8");
      socket.end();
      resolve(bytesSent);
    });

    socket.once("error", (error) => {
      socket.destroy();
      reject(describeStreamError(error));
    });
  });
}

export async function streamCotEvents(
  profile: ResolvedProfile,
  timeoutMs: number,
  options: {
    limit?: number;
    onEvent: (xml: string, sequence: number) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const socket = await connectCotSocket(profile, timeoutMs);

  return new Promise<void>((resolve, reject) => {
    let buffer = "";
    let done = false;
    let sequence = 0;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      socket.removeListener("data", onData);
      socket.removeListener("end", onEnd);
      socket.removeListener("close", onClose);
      socket.removeListener("error", onError);
    };

    const finish = () => {
      if (done) {
        return;
      }

      done = true;
      cleanup();
      socket.end();
      resolve();
    };

    const fail = (error: unknown) => {
      if (done) {
        return;
      }

      done = true;
      cleanup();
      socket.destroy();
      reject(describeStreamError(error));
    };

    const onAbort = () => finish();
    const onEnd = () => finish();
    const onClose = () => finish();
    const onError = (error: unknown) => fail(error);
    const onData = (chunk: Buffer | string) => {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;

      while (true) {
        const endIndex = buffer.indexOf("</event>");
        if (endIndex === -1) {
          return;
        }

        const startIndex = buffer.indexOf("<event");
        if (startIndex === -1 || startIndex > endIndex) {
          buffer = buffer.slice(endIndex + "</event>".length);
          continue;
        }

        const frame = buffer.slice(startIndex, endIndex + "</event>".length);
        buffer = buffer.slice(endIndex + "</event>".length);
        sequence += 1;
        options.onEvent(frame, sequence);

        if (options.limit !== undefined && sequence >= options.limit) {
          finish();
          return;
        }
      }
    };

    if (options.signal?.aborted) {
      finish();
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}
