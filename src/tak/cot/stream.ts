import net from "node:net";
import tls from "node:tls";
import { setTimeout as delay } from "node:timers/promises";

import type { ResolvedProfile } from "../../core/profile-resolution.js";
import { buildTlsClientOptions, describeTlsClientError } from "../tls.js";

export interface CotEventWriter {
  close: () => Promise<void>;
  send: (xml: string) => Promise<number>;
}

function describeStreamError(error: unknown): Error {
  const clientError = describeTlsClientError(error);
  const message = clientError.message;
  if (
    /certificate required|alert certificate required|bad certificate|handshake failure|unknown ca/i.test(
      message
    )
  ) {
    return new Error(
      "The CoT stream rejected the TLS connection. Configure tls.certFile and tls.keyFile if the server requires a client certificate."
    );
  }

  return clientError;
}

function connectCotSocket(profile: ResolvedProfile, timeoutMs: number): Promise<tls.TLSSocket> {
  const tlsOptions = buildTlsClientOptions(profile.host, profile.tls);

  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({
      ...tlsOptions,
      host: profile.host,
      port: profile.ports.cot,
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
  const writer = await openCotEventWriter(profile, timeoutMs);

  try {
    return await writer.send(xml);
  } finally {
    await writer.close();
  }
}

export async function openCotEventWriter(
  profile: ResolvedProfile,
  timeoutMs: number
): Promise<CotEventWriter> {
  const socket = await connectCotSocket(profile, timeoutMs);
  let closed = false;
  let fatalError: Error | undefined;

  socket.on("error", (error) => {
    fatalError = describeStreamError(error);
  });

  return {
    close: async () => {
      if (closed) {
        return;
      }

      closed = true;
      await new Promise<void>((resolve) => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }

          settled = true;
          socket.off("close", finish);
          resolve();
        };

        socket.once("close", finish);
        socket.end(() => finish());
        void delay(1000).then(() => {
          if (!settled) {
            socket.destroy();
          }
          finish();
        });
      });
    },
    send: async (xml: string) => {
      if (closed) {
        throw new Error("The CoT writer is already closed.");
      }

      if (fatalError) {
        throw fatalError;
      }

      return await new Promise<number>((resolve, reject) => {
        const bytesSent = Buffer.byteLength(xml, "utf8");

        const cleanup = () => {
          socket.off("close", onClose);
          socket.off("error", onError);
        };

        const onClose = () => {
          cleanup();
          reject(new Error("The CoT connection closed before the event was written."));
        };

        const onError = (error: unknown) => {
          cleanup();
          reject(describeStreamError(error));
        };

        socket.once("close", onClose);
        socket.once("error", onError);
        socket.write(xml, "utf8", (error) => {
          cleanup();
          if (error) {
            reject(describeStreamError(error));
            return;
          }

          resolve(bytesSent);
        });
      });
    }
  };
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
