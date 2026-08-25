import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, unwrap } from '../api';
import { useAuth } from '../auth';

const CONTACT = 'admin@moveto.kr';
const UPDATED = '2026년 8월 25일';

function PublicLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-full bg-white px-5 py-10 text-ink">
      <article className="mx-auto max-w-3xl">
        <nav
          className="mb-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"
          aria-label="법적 고지 및 지원"
        >
          <Link className="display text-xl" to="/">
            litechat
          </Link>
          <Link className="underline" to="/privacy">
            개인정보처리방침
          </Link>
          <Link className="underline" to="/terms">
            이용약관
          </Link>
          <Link className="underline" to="/support">
            지원
          </Link>
          <Link className="underline" to="/account-deletion">
            계정 삭제
          </Link>
        </nav>
        <h1 className="display text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-mute">최종 업데이트: {UPDATED}</p>
        <div className="legal-content mt-8">{children}</div>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <PublicLayout title="개인정보처리방침">
      <p>
        litechat 운영자는 실시간 채팅 서비스와 모바일 앱을 제공하기 위해 아래 정보를 처리합니다.
        개인정보 문의는 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>로 보낼 수 있습니다.
      </p>
      <h2>수집하는 정보와 목적</h2>
      <ul>
        <li>
          <strong>계정:</strong> 아이디, 닉네임, 단방향 암호화된 비밀번호. 가입, 로그인, 계정 보호에
          필요합니다. 아이디와 닉네임은 친구 검색 결과 및 친구·대화 상대에게 표시됩니다.
        </li>
        <li>
          <strong>서비스 콘텐츠:</strong> 친구 관계, 1:1 메시지, 읽음 상태, 신고·차단 기록, 사용자가
          선택해 업로드한 사진. 채팅 제공과 신고 처리에 필요합니다.
        </li>
        <li>
          <strong>기기·접속 및 분석:</strong> IP 주소, 브라우저/기기 모델, 운영체제와 앱 버전,
          방문·화면 경로, 세션/방문자 식별자, 웹 성능 지표, IP 기반 국가·지역·도시와 대략적 좌표.
          보안, 장애 진단, 서비스 성능 및 이용 현황 파악에 사용합니다.
        </li>
        <li>
          <strong>알림:</strong> 웹 Push 구독 정보 또는 Expo Push 토큰, 알림 전송·수신 상태.
          사용자가 알림을 켠 경우 새 메시지 알림에 사용합니다.
        </li>
      </ul>
      <h2>권한과 선택</h2>
      <p>
        모바일 앱은 사용자가 사진 전송을 선택할 때 사진 보관함 접근을 요청합니다. 웹 카메라는
        사용자가 촬영 기능을 직접 열었을 때만 브라우저가 권한을 요청하며, 촬영한 이미지가 전송되기
        전까지 기기 안에서 처리됩니다. 알림은 선택 기능이며 거부해도 채팅을 사용할 수 있습니다.
        모바일 앱은 카메라, 마이크, 연락처 또는 위치 권한을 요청하지 않습니다.
      </p>
      <h2>제공업체와 공유</h2>
      <p>
        알림을 켜면 토큰과 알림 내용(보낸 사람의 닉네임, 메시지 미리보기, 대화 식별자)이 Expo Push
        Service 및 기기 플랫폼의 Apple Push Notification service 또는 Firebase Cloud Messaging을
        거쳐 전달됩니다. IP 정밀 분석 기능을 운영자가 특정 계정에 대해 활성화한 경우 IP 주소가
        MaxMind GeoIP2 Insights로 전송될 수 있습니다. 호스팅·네트워크 사업자는 서비스 운영 과정에서
        데이터를 처리할 수 있습니다. litechat은 광고 네트워크에 데이터를 판매하거나 다른 회사의
        앱·웹사이트를 가로질러 추적하지 않습니다.
      </p>
      <h2>보관과 삭제</h2>
      <p>
        계정과 채팅 콘텐츠는 계정이 유지되는 동안 보관합니다. 서비스 분석 세션·이벤트와 알림 진단
        로그는 최대 90일, 오래된 IP 위치 캐시는 최대 30일, 처리 완료된 신고 기록은 최대 1년
        보관하도록 서비스가 자동 정리합니다. 계정을 삭제하면 활성 서비스의 프로필, 인증 정보, 세션,
        친구 관계, 대화·메시지, 업로드 이미지, 알림 토큰, 신고·차단 기록 및 계정에 연결된 분석
        데이터가 삭제됩니다. 현재 애플리케이션은 별도의 법적 보존 범주를 구현하지 않습니다.
      </p>
      <h2>보안과 이용자 권리</h2>
      <p>
        전송에는 HTTPS를 사용하고, 비밀번호는 Argon2id 해시로 저장하며, 모바일 세션은 기기의
        Keychain/Keystore 보호 저장소에 보관합니다. 사용자는 앱의 프로필 → 계정 관리 또는{' '}
        <Link to="/account-deletion">웹 계정 삭제 페이지</Link>에서 삭제할 수 있습니다.
        열람·정정·삭제 또는 동의 철회 관련 문의는 <a href={`mailto:${CONTACT}`}>{CONTACT}</a>로 보내
        주세요.
      </p>
      <p>
        서비스 대상 지역에 적용되는 법률에 따라 추가 권리가 있을 수 있습니다. 중요한 변경은 이
        페이지의 날짜와 서비스 내 공지로 알립니다.
      </p>
    </PublicLayout>
  );
}

export function TermsPage() {
  return (
    <PublicLayout title="이용약관">
      <p>
        이 약관은 litechat 실시간 채팅 서비스 이용에 적용됩니다. 계정을 만들거나 서비스를 사용하면
        약관에 동의합니다.
      </p>
      <h2>계정과 안전</h2>
      <p>
        정확한 가입 정보를 사용하고 비밀번호와 기기 접근을 안전하게 관리해야 합니다. 다른 사람을
        괴롭히거나, 불법·혐오·성적·폭력적 콘텐츠, 스팸, 악성 파일 또는 타인의 권리를 침해하는
        콘텐츠를 전송해서는 안 됩니다.
      </p>
      <h2>콘텐츠와 조치</h2>
      <p>
        사용자는 자신이 전송하는 콘텐츠에 필요한 권리를 보유해야 합니다. 신고가 접수되면 운영자는
        콘텐츠와 계정을 검토하고, 안전과 법률 준수를 위해 접근 제한이나 계정 조치를 취할 수
        있습니다. 사용자는 앱에서 메시지·사용자를 신고하고 사용자를 차단할 수 있습니다.
      </p>
      <h2>서비스 변경과 책임</h2>
      <p>
        안정적 제공을 위해 노력하지만 점검, 장애, 네트워크 또는 플랫폼 사유로 서비스가 중단될 수
        있습니다. 법률이 허용하는 범위에서 간접 손해에 대한 책임은 제한됩니다. 소비자에게 강행
        적용되는 권리는 제한하지 않습니다.
      </p>
      <h2>종료와 문의</h2>
      <p>
        사용자는 언제든 계정을 삭제할 수 있습니다. 중대한 약관 위반이나 서비스 안전 위험이 있으면
        운영자가 이용을 제한할 수 있습니다. 문의: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </PublicLayout>
  );
}

export function SupportPage() {
  return (
    <PublicLayout title="지원 및 문의">
      <p>
        로그인, 메시지, 사진, 알림, 신고·차단 또는 계정 삭제에 도움이 필요하면 아래 이메일로 문의해
        주세요.
      </p>
      <p>
        <a
          className="inline-flex min-h-12 items-center rounded-full bg-primary px-6 text-white"
          href={`mailto:${CONTACT}?subject=litechat%20지원%20문의`}
        >
          {CONTACT}로 이메일 보내기
        </a>
      </p>
      <h2>문의할 때</h2>
      <p>
        사용 중인 플랫폼(iOS/Android/웹), 문제가 발생한 대략적인 시각과 재현 단계를 적어 주세요.
        비밀번호, 세션 토큰, 인증 코드 등 민감한 정보는 보내지 마세요.
      </p>
      <h2>계정 삭제</h2>
      <p>
        앱에서는 프로필 → 계정 관리 → 계정 영구 삭제를 이용하세요. 앱을 사용할 수 없다면{' '}
        <Link to="/account-deletion">웹 삭제 페이지</Link>에서 본인 확인 후 직접 삭제할 수 있습니다.
      </p>
    </PublicLayout>
  );
}

export function AccountDeletionPage() {
  const { me, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirm || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!me) {
        await unwrap(await api.api.auth.login.$post({ json: { username, password } }));
      }
      await unwrap(await api.api.auth.account.$delete({ json: { password } }));
      // The deletion endpoint revokes the cookie/server sessions. Clear the
      // in-memory identity and all account-scoped queries before navigating.
      await logout();
      setDone(true);
      setPassword('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout title="litechat 계정 삭제">
      <p>
        이 페이지는 litechat 모바일 앱과 웹 서비스 계정을 삭제하는 공식 경로입니다. 앱 설치 없이
        사용할 수 있습니다.
      </p>
      <h2>삭제되는 데이터</h2>
      <p>
        프로필과 로그인 정보, 모든 세션, 친구 관계, 대화·메시지, 읽음 상태, 업로드 사진, 알림 토큰,
        신고·차단 기록 및 계정에 연결된 분석 데이터가 활성 서비스에서 영구 삭제됩니다. 로그아웃이나
        일시 비활성화가 아니며 되돌릴 수 없습니다. 현재 애플리케이션은 별도의 법적 보존 범주를
        구현하지 않습니다.
      </p>
      {done ? (
        <div className="mt-8 rounded-xl border border-hairline bg-canvas-soft p-5" role="status">
          <h2 className="mt-0">삭제가 완료되었습니다</h2>
          <p>계정과 연결 데이터가 삭제되고 모든 세션이 종료되었습니다.</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-8 space-y-4 rounded-xl border border-hairline p-5"
          noValidate
        >
          {!me && (
            <label className="block">
              <span className="mb-1 block text-sm">아이디</span>
              <input
                required
                autoComplete="username"
                pattern="[a-z0-9_]{3,20}"
                maxLength={20}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                className="min-h-12 w-full rounded-md border border-hairline-input px-3"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm">현재 비밀번호</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              minLength={8}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-12 w-full rounded-md border border-hairline-input px-3"
            />
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
              className="mt-1 size-5"
            />
            <span>위 데이터를 영구 삭제하며 이 작업을 되돌릴 수 없음을 이해했습니다.</span>
          </label>
          {error && (
            <p className="text-sm text-ruby" role="alert">
              {error}
            </p>
          )}
          <button
            disabled={!confirm || busy || password.length < 8 || (!me && username.length < 3)}
            className="min-h-12 w-full rounded-full bg-ruby px-6 font-semibold text-white disabled:opacity-40"
          >
            {busy ? '삭제 중…' : '계정 영구 삭제'}
          </button>
        </form>
      )}
    </PublicLayout>
  );
}
