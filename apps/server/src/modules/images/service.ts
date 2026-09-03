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
import { SafetyRepo } from '../safety/repo';

/** 저화질 webp 변환 파라미터 — 데이터 절약과 알아볼 수 있는 화질의 절충점 */
const WEBP_MAX_WIDTH = 640;
const WEBP_QUALITY = 40;

/**
 * 디코딩을 허용할 최대 픽셀 수 (5천만 = 50 MP).
 *
 * MAX_IMAGE_BYTES(10 MB)는 **압축된** 크기 상한이라 메모리를 보호하지 못한다.
 * 균일한 색으로 채운 PNG는 몇 MB로도 기가픽셀 이미지가 되고, sharp 기본 상한
 * (268 MP)이면 디코딩 버퍼만 1 GB를 넘겨 컨테이너 메모리 한도(3 GB)를 위협한다.
 * 50 MP는 현존 스마트폰 카메라(최대 ~48 MP)를 모두 수용하면서 폭탄 이미지는 막는다.
 * 상한을 넘으면 sharp가 예외를 던지고, 아래에서 INVALID_IMAGE로 거절된다.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * libvips 연산 캐시를 끈다.
 *
 * 이 캐시는 **같은 입력에 같은 연산**을 반복할 때만 이득이다. 채팅 업로드는 매번
 * 서로 다른 이미지를 한 번씩만 변환하므로 적중률이 0에 가깝고, 기본 설정(50 MB)만큼
 * RSS를 붙들고 있게 된다. 메모리가 제한된 컨테이너에서는 그냥 낭비다.
 */
sharp.cache(false);

/** sharp가 감지한 포맷 → 저장 확장자/Content-Type */
const FORMAT_INFO: Record<string, { ext: string; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif' },
};

export class ImagesService {
  private repo: ImagesRepo;
  private safety: SafetyRepo;

  constructor(private deps: AppDeps) {
    this.repo = new ImagesRepo(deps.db);
    this.safety = new SafetyRepo(deps.db);
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
    // 하나의 파이프라인을 만들어 메타데이터 확인과 변환에 함께 쓴다.
    const pipeline = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS });
    let format: string;
    try {
      format = (await pipeline.metadata()).format ?? '';
    } catch {
      throw errors.badRequest('INVALID_IMAGE');
    }
    const info = FORMAT_INFO[format];
    if (!info) throw errors.badRequest('INVALID_IMAGE');

    // EXIF 회전을 반영한 뒤 640px 상한으로 축소(확대는 안 함)하고 저화질 webp로 변환한다.
    // 픽셀 수 상한을 넘는 입력은 여기서 sharp가 던지고 INVALID_IMAGE로 거절된다.
    let webp;
    try {
      webp = await pipeline
        .rotate()
        .resize({ width: WEBP_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw errors.badRequest('INVALID_IMAGE');
    }

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
    return image !== null && this.canAccessImage(userId, image);
  }

  /**
   * 이미 조회한 이미지 행으로 접근 권한을 판정한다 — getFile이 같은 행을 두 번
   * 읽지 않게 하려고 분리했다.
   *
   * 참여자 확인 쿼리는 ix_messages_image_content(부분 인덱스)를 탄다. 이 인덱스가
   * 없으면 messages 전체 스캔이 되어, 상대가 보낸 사진을 열 때마다 전체 메시지 수에
   * 비례하는 비용이 든다(마이그레이션 v9 주석 참고).
   */
  private canAccessImage(userId: number, image: { id: string; owner_id: number }): boolean {
    const imageId = image.id;
    if (image.owner_id === userId) return true;
    if (this.safety.isBlockedEitherWay(userId, image.owner_id)) return false;

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
    if (!this.canAccessImage(userId, image)) throw errors.forbidden();

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
