import { Agent, buildConnector } from 'undici';
import dns from 'node:dns';
import net from 'node:net';
import { isBlockedIp } from './webhook.url.validator';

// Pins DNS resolution: every resolved IP is checked with `isBlockedIp` and
// the caller (undici) connects to that same set. Closes the TOCTOU window
// `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
const connect = buildConnector({
  lookup(hostname, options, callback) {
    dns.lookup(hostname, options, (err, address: any, family: any) => {
      if (err) return callback(err, '', 0);
      if (Array.isArray(address)) {
        for (const entry of address) {
          if (isBlockedIp(entry.address)) {
            return callback(new Error('Blocked IP'), '', 0);
          }
        }
        return callback(null, address as any, 0);
      }
      if (isBlockedIp(address)) {
        return callback(new Error('Blocked IP'), '', 0);
      }
      callback(null, address, family);
    });
  },
});

// Node never calls `lookup` for a literal IP, so `http://127.0.0.1:…` used to
// connect straight past the check — and so did any redirect to one, since
// every hop goes through this dispatcher (E2E-08-26). Checked before
// connecting instead.
export const ssrfSafeDispatcher = new Agent({
  connect(options, callback) {
    const host = options.hostname.replace(/^\[(.*)\]$/, '$1');
    if (net.isIP(host) && isBlockedIp(host)) {
      callback(new Error('Blocked IP'), null);
      return;
    }
    connect(options, callback);
  },
});
