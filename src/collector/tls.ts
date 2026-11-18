import { connect, type PeerCertificate } from 'node:tls';
import type { TlsInfo } from '../types.ts';

/** Connects to the HTTPS host and reports whether its certificate validates. */
export function inspectTls(url: string, timeoutMs = 8_000, now = Date.now()): Promise<TlsInfo> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({
      host: hostname,
      port: Number(port || 443),
      servername: hostname,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
    const done = (info: TlsInfo) => {
      socket.destroy();
      resolve(info);
    };
    socket.once('secureConnect', () => {
      const cert: PeerCertificate = socket.getPeerCertificate();
      const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined;
      const daysRemaining = validTo ? Math.floor((validTo.getTime() - now) / 86_400_000) : undefined;
      const issuer = cert.issuer as Partial<Record<string, string>> | undefined;
      const authError = socket.authorizationError as Error | string | null;
      const error = authError ? String(authError instanceof Error ? authError.message : authError) : undefined;
      done({
        valid: socket.authorized && (daysRemaining ?? 0) >= 0,
        ...(issuer?.O || issuer?.CN ? { issuer: issuer.O ?? issuer.CN ?? '' } : {}),
        ...(validTo ? { validTo: validTo.toISOString() } : {}),
        ...(daysRemaining !== undefined ? { daysRemaining } : {}),
        ...(error ? { error } : {}),
      });
    });
    socket.once('timeout', () => {
      done({ valid: false, error: 'TLS handshake timed out' });
    });
    socket.once('error', (err) => {
      done({ valid: false, error: err.message });
    });
  });
}
