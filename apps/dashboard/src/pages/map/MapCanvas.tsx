/**
 * 지도 캔버스 — 뷰포트 전체를 채우는 Google Maps + 오버레이 3종.
 *
 * 1. 밀도 원(GeoAreaCircle): 지점별 접속 밀도. **미터 기반 google.maps.Circle**이라
 *    줌을 바꿔도 항상 실제 지리 반경(GeoLite2 accuracy_radius)을 나타낸다 — 예전
 *    픽셀 고정 div 마커가 줌마다 반경이 달라 보이던 문제의 해결책. 접속 수는 원의
 *    채움 불투명도와 중앙 카운트 칩으로 인코딩한다.
 * 2. 접속 기록 핀: 현재 패널에 나열된 기록 중 위치가 있는 것들. 선택된 기록은
 *    잉크 블랙 + 확대로 강조되어 어느 핀인지 바로 보인다.
 * 3. 선택 기록의 정확도 원: Insights(유료) 반경이 있으면 그것을, 없으면 세션에
 *    저장된 GeoLite2 반경을 그린다.
 *
 * API 키는 빌드 시점이 아니라 서버 환경변수(GOOGLE_MAPS_API_KEY)에서 런타임에
 * 받아온다 (키 교체 시 재빌드가 필요 없고, Dokploy가 서버 컨테이너에만 환경변수를
 * 주입하기 때문).
 */
import { useEffect } from 'react';
import { AdvancedMarker, APIProvider, Circle, Map, Pin, useMap } from '@vis.gl/react-google-maps';
import type { AdminConfig, GeoPoint, SessionRow } from '../../api';
import { DEFAULT_ACCURACY_KM, PIN, formatDate, type MapTarget, type SelectedCircle } from './shared';

interface MapCanvasProps {
  config: AdminConfig | null;
  target: MapTarget | null;
  points: GeoPoint[];
  /** 패널에 나열된 접속 기록 중 위치가 있는 것들 — 핀으로 표시 */
  locatedSessions: SessionRow[];
  selectedSessionId: string | null;
  selectedCircle: SelectedCircle | null;
  onSelectSession: (row: SessionRow) => void;
}

export function MapCanvas({
  config,
  target,
  points,
  locatedSessions,
  selectedSessionId,
  selectedCircle,
  onSelectSession,
}: MapCanvasProps) {
  if (config && !config.googleMapsApiKey) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-mute">
        Google Maps API 키가 설정되지 않았습니다. 서버 환경변수 GOOGLE_MAPS_API_KEY를 지정하세요.
      </div>
    );
  }
  if (!config) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-mute">
        지도 불러오는 중…
      </div>
    );
  }

  const max = Math.max(0, ...points.map((p) => p.count));

  return (
    <APIProvider apiKey={config.googleMapsApiKey}>
      <Map
        className="h-full w-full"
        defaultCenter={{ lat: 20, lng: 10 }}
        defaultZoom={2}
        mapId={config.googleMapsMapId}
        colorScheme="DARK"
        gestureHandling="greedy"
        disableDefaultUI={false}
      >
        <MapController target={target} />

        {points.map((p) => (
          <GeoAreaCircle key={`${p.lat},${p.lon}`} point={p} max={max} />
        ))}

        {/* 접속 기록 핀 — 클릭하면 해당 기록이 선택된다 (선택 = 잉크 블랙 + 확대) */}
        {locatedSessions.map((row) => {
          const selected = selectedSessionId === row.id;
          return (
            <AdvancedMarker
              key={row.id}
              position={{ lat: row.lat!, lng: row.lon! }}
              title={`${formatDate(row.createdAt)} · ${row.ip}`}
              zIndex={selected ? 30 : 10}
              onClick={() => onSelectSession(row)}
            >
              <Pin
                background={selected ? PIN.selectedBg : PIN.normalBg}
                borderColor={PIN.border}
                glyphColor={PIN.glyph}
                scale={selected ? 1.15 : 0.8}
              />
            </AdvancedMarker>
          );
        })}

        {/* 선택한 기록의 정확도 반경 (km → m) */}
        {selectedCircle && (
          <Circle
            center={{ lat: selectedCircle.lat, lng: selectedCircle.lng }}
            radius={selectedCircle.radiusKm * 1000}
            strokeColor="#ffffff"
            strokeOpacity={0.9}
            strokeWeight={2}
            fillColor="#ffffff"
            fillOpacity={0.15}
            clickable={false}
          />
        )}
      </Map>
    </APIProvider>
  );
}

/** 지도 이동 컨트롤러 — target이 바뀌면 해당 위치로 팬/줌한다 (Map 자식으로만 동작) */
function MapController({ target }: { target: MapTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo({ lat: target.lat, lng: target.lng });
    if (target.zoom) map.setZoom(target.zoom);
  }, [map, target]);
  return null;
}

/**
 * 밀도 지점 — 미터 기반 정확도 원 + 중앙 카운트 칩.
 * 정확도가 없는 레거시 지점은 기본 반경을 옅게 그려 "추정"임을 드러낸다.
 */
function GeoAreaCircle({ point, max }: { point: GeoPoint; max: number }) {
  const estimated = point.accuracyKm === null;
  const radiusKm = point.accuracyKm ?? DEFAULT_ACCURACY_KM;
  // 접속 수 → 채움 불투명도 (0.08~0.22). 반경은 밀도가 아니라 실제 지리 정확도만 나타낸다.
  const density = max > 0 ? point.count / max : 0;
  const label = `${[point.city, point.country].filter(Boolean).join(', ') || '알 수 없음'} · ${point.count}건${estimated ? ' · 반경 추정' : ` · 반경 ${radiusKm}km`}`;
  return (
    <>
      <Circle
        center={{ lat: point.lat, lng: point.lon }}
        radius={radiusKm * 1000}
        strokeColor="#ffffff"
        strokeOpacity={estimated ? 0.25 : 0.6}
        strokeWeight={1}
        fillColor="#ffffff"
        fillOpacity={(estimated ? 0.5 : 1) * (0.08 + density * 0.14)}
        clickable={false}
      />
      <AdvancedMarker position={{ lat: point.lat, lng: point.lon }} title={label}>
        {point.count > 1 ? (
          <span className="tnum rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black shadow-none">
            {point.count}
          </span>
        ) : (
          <span className="block h-2 w-2 rounded-full border border-black/40 bg-white" />
        )}
      </AdvancedMarker>
    </>
  );
}
