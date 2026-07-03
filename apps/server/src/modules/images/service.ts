/**
 * 이미지 서비스 — 업로드/변환/접근 제어
 *
 * PROJECT.md의 이미지 처리 정책:
 *  - 원본을 그대로 저장한다
 *  - 업로드 시 고효율 저화질 webp(640px, q40)로 변환한다
 *  - 채팅방에는 webp를 기본 표시하고, 클릭 시 원본/저화질 다운로드를 제공한다
 *
 * 접근 제어: 업로더 본인이거나, 이미지가 메시지로 등장한 대화의 참여자만 볼 수 있다.
 */
import { MAX_IMAGE_BYTES, type WireImage } from '@litechat/types';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AppDeps } from '../../deps';
import { errors } from '../../errors';
import { ImagesRepo } from './repo';

/** 저화질 webp 변환 파라미터 — 데이터 절약과 알아볼 수 있는 화질의 절충점 */
const WEBP_MAX_WIDTH = 640;
const WEBP_QUALITY = 40;

/** sharp가 감지한 포맷 → 저장 확장자/Content-Type */
const FORMAT_INFO: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif' },
};

export class ImagesService {
  private repo: ImagesRepo;

  constructor(private deps: AppDeps) {
    this.repo = new ImagesRepo(deps.db);
    // 업로드 디렉터리를 미리 만들어 둔다 (Docker 볼륨 첫 마운트 대비).
    mkdirSync(deps.config.uploadDir, { recursive: true });
  }

  /** 원본 저장 + webp 변환 + 메타데이터 기록. 반환값은 와이어 포맷. */
  async upload(ownerId: number, file: File): Promise<WireImage> {
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      throw errors.badRequest('INVALID_IMAGE');
    }

    const original = Buffer.from(await file.arrayBuffer());

    // 실제 바이트를 검사해 포맷을 판별한다 (클라이언트 Content-Type은 신뢰하지 않음).
    let format: string;
    try {
      format = (await sharp(original).metadata()).format ?? '';
    } catch {
      throw errors.badRequest('INVALID_IMAGE');
    }
    const info = FORMAT_INFO[format];
    if (!info) throw errors.badRequest('INVALID_IMAGE');

    // EXIF 회전을 반영한 뒤 640px 상한으로 축소(확대는 안 함)하고 저화질 webp로 변환한다.
    const webp = await sharp(original)
      .rotate()
      .resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    const id = crypto.randomUUID().replaceAll('-', '');
    const origPath = join(this.deps.config.uploadDir, `${id}.${info.ext}`);
    const webpPath = join(this.deps.config.uploadDir, `${id}.thumb.webp`);
    await Bun.write(origPath, original);
    await Bun.write(webpPath, new Uint8Array(webp.data));

    this.repo.insert({
      id,
      owner_id: ownerId,
      orig_path: origPath,
      webp_path: webpPath,
      orig_bytes: original.byteLength,
      webp_bytes: webp.data.byteLength,
      width: webp.info.width,
      height: webp.info.height,
    });

    return {
      id,
      w: webp.info.width,
      h: webp.info.height,
      tb: webp.data.byteLength,
      ob: original.byteLength,
    };
  }

  /** 접근 가능 여부 — 업로더 본인 또는 이미지가 전송된 대화의 참여자 */
  canAccess(userId: number, imageId: string): boolean {
    const image = this.repo.findById(imageId);
    if (!image) return false;
    if (image.owner_id === userId) return true;

    const row = this.deps.db
      .query<{ ok: number }, [string, number, number]>(
        `SELECT 1 AS ok FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.kind = 'i' AND m.content = ? AND (c.user_a = ? OR c.user_b = ?)
         LIMIT 1`,
      )
      .get(imageId, userId, userId);
    return row !== null;
  }

  /** 파일 서빙 정보 조회 — 라우트가 그대로 Response로 변환한다 */
  getFile(
    userId: number,
    imageId: string,
    variant: 'thumb' | 'orig',
  ): { path: string; contentType: string; downloadName: string } {
    const image = this.repo.findById(imageId);
    if (!image) throw errors.notFound();
    if (!this.canAccess(userId, imageId)) throw errors.forbidden();

    if (variant === 'thumb') {
      return {
        path: image.webp_path,
        contentType: 'image/webp',
        downloadName: `litechat-${imageId}.webp`,
      };
    }
    const ext = image.orig_path.split('.').pop() ?? 'bin';
    const mime = Object.values(FORMAT_INFO).find((f) => f.ext === ext)?.mime;
    return {
      path: image.orig_path,
      contentType: mime ?? 'application/octet-stream',
      downloadName: `litechat-${imageId}.${ext}`,
    };
  }
}
