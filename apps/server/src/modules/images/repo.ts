/**
 * images 테이블 저장소 — 파일 본체는 디스크, 메타데이터만 DB에 둔다.
 */
import type { Database } from 'bun:sqlite';

export interface ImageRow {
  id: string;
  owner_id: number;
  orig_path: string;
  webp_path: string;
  orig_bytes: number;
  webp_bytes: number;
  width: number;
  height: number;
}

export class ImagesRepo {
  constructor(private db: Database) {}

  insert(row: ImageRow): void {
    this.db
      .query(
        `INSERT INTO images (id, owner_id, orig_path, webp_path, orig_bytes, webp_bytes, width, height, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.owner_id,
        row.orig_path,
        row.webp_path,
        row.orig_bytes,
        row.webp_bytes,
        row.width,
        row.height,
        Math.floor(Date.now() / 1000),
      );
  }

  findById(id: string): ImageRow | null {
    return this.db
      .query<ImageRow, [string]>(
        `SELECT id, owner_id, orig_path, webp_path, orig_bytes, webp_bytes, width, height
         FROM images WHERE id = ?`,
      )
      .get(id);
  }
}
