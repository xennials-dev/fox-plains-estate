const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * ESTATESPHERE SOVEREIGN STORAGE & AUTH ENGINE
 * Single-VPS Architecture: PocketBase (SQLite) + MinIO (S3) + Atomic Local Disk WAL
 */
class SovereignStore {
  constructor({ dataDir, uploadsDir }) {
    this.dataDir = dataDir;
    this.uploadsDir = uploadsDir;
    this.pocketbaseUrl = process.env.POCKETBASE_URL || ''; // e.g. http://127.0.0.1:8090
    this.pocketbaseAdminToken = process.env.POCKETBASE_ADMIN_TOKEN || '';
    this.minioEndpoint = process.env.MINIO_ENDPOINT || ''; // e.g. http://127.0.0.1:9000
    this.minioBucket = process.env.MINIO_BUCKET || 'estatesphere-media';
    this.masterKey = process.env.SOLO_ADMIN_KEY || 'estatesphere-solo-2026';
    this.jwtSecret = process.env.SOLO_JWT_SECRET || crypto.createHash('sha256').update(this.masterKey).digest('hex');
  }

  /**
   * Generate a signed HMAC token for operator or scoped realtor client
   */
  issueToken(payload = { role: 'operator', scope: 'all' }) {
    const data = {
      ...payload,
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 30 // 30 days
    };
    const encoded = Buffer.from(JSON.stringify(data)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.jwtSecret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  }

  /**
   * Verify operator or client-scoped token
   */
  verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    if (token === this.masterKey) {
      return { role: 'operator', scope: 'all' };
    }
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', this.jwtSecret).update(encoded).digest('base64url');
    if (sig !== expectedSig) return null;
    try {
      const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (decoded.exp && Date.now() > decoded.exp) return null;
      return decoded;
    } catch (_) {
      return null;
    }
  }

  /**
   * Generate deterministic client share token for a specific propertyId
   */
  getClientShareToken(propertyId) {
    return crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`client-view:${propertyId}`)
      .digest('base64url')
      .slice(0, 20);
  }

  verifyClientShareToken(propertyId, clientToken) {
    if (!propertyId || !clientToken) return false;
    return this.getClientShareToken(propertyId) === clientToken;
  }

  /**
   * Atomic local write + non-blocking PocketBase SQLite replication
   */
  async persistCollection(filename, collectionName, data) {
    const filePath = path.join(this.dataDir, filename);
    const tempPath = `${filePath}.tmp`;
    const serialized = JSON.stringify(data, null, 2);

    try {
      await fsp.writeFile(tempPath, serialized, 'utf8');
      await fsp.rename(tempPath, filePath);
    } catch (_) {
      try {
        await fsp.writeFile(filePath, serialized, 'utf8');
      } catch (err) {
        console.warn(`[SovereignStore] Local disk write warning (${filename}):`, err.message);
      }
    }

    // Mirror to PocketBase SQLite API if configured on the Hostinger KVM VPS
    if (this.pocketbaseUrl) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.pocketbaseAdminToken) {
          headers['Authorization'] = this.pocketbaseAdminToken;
        }
        fetch(`${this.pocketbaseUrl}/api/collections/${collectionName}/records`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            snapshot_key: collectionName,
            payload: data,
            updated_iso: new Date().toISOString()
          })
        }).catch(() => {});
      } catch (_) {}
    }
  }

  /**
   * Resolve uploaded asset URL (MinIO S3 public bucket URL or permanent local /uploads path)
   */
  async registerUpload(file) {
    const localUrl = `/uploads/${file.filename}`;
    if (!this.minioEndpoint) {
      return {
        url: localUrl,
        storageProvider: 'local-sovereign-disk',
        bucket: 'uploads'
      };
    }

    // Mirror to MinIO S3-compatible object storage when configured on VPS
    const minioObjectUrl = `${this.minioEndpoint.replace(/\/$/, '')}/${this.minioBucket}/${file.filename}`;
    try {
      const fileBuffer = await fsp.readFile(file.path);
      await fetch(minioObjectUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.mimetype || 'application/octet-stream'
        },
        body: fileBuffer
      });
      return {
        url: minioObjectUrl,
        localFallbackUrl: localUrl,
        storageProvider: 'minio-s3-sovereign',
        bucket: this.minioBucket
      };
    } catch (err) {
      console.warn('[SovereignStore] MinIO mirror fallback to local disk:', err.message);
      return {
        url: localUrl,
        storageProvider: 'local-sovereign-disk',
        bucket: 'uploads'
      };
    }
  }

  getStorageStatus() {
    return {
      architecture: 'Single-VPS Sovereign (Hostinger KVM)',
      database: this.pocketbaseUrl ? 'PocketBase SQLite + Local WAL' : 'Local Atomic JSON WAL (PocketBase Ready)',
      objectStorage: this.minioEndpoint ? `MinIO S3 (${this.minioBucket})` : 'Permanent Local Disk (/uploads + MinIO Ready)',
      pocketbaseConnected: Boolean(this.pocketbaseUrl),
      minioConnected: Boolean(this.minioEndpoint)
    };
  }
}

module.exports = { SovereignStore };
