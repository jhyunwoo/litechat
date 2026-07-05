/**
 * 지도 — 세션의 GeoIP 위치를 원형 마커로 표시한다 (OpenStreetMap 타일, API 키 불필요).
 * 기본 Marker 아이콘 대신 CircleMarker를 써서 아이콘 에셋 경로 문제를 피한다.
 */
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { adminApi, type GeoPoint } from '../api';

/** 접속 수에 비례해 마커 반지름을 키운다 (5~22px) */
function radiusFor(count: number, max: number): number {
  if (max <= 0) return 5;
  return 5 + (count / max) * 17;
}

export default function MapPage() {
  const [points, setPoints] = useState<GeoPoint[]>([]);

  useEffect(() => {
    void adminApi.geo(30).then(setPoints);
  }, []);

  const max = Math.max(0, ...points.map((p) => p.count));

  return (
    <div className="rounded-xl border border-hairline bg-card p-5">
      <h2 className="mb-4 text-sm text-ink-mute">접속 위치 (최근 30일, {points.length}개 지점)</h2>
      <MapContainer center={[20, 10]} zoom={2} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => (
          <CircleMarker
            key={`${p.lat},${p.lon}`}
            center={[p.lat, p.lon]}
            radius={radiusFor(p.count, max)}
            pathOptions={{ color: '#8b7bff', fillColor: '#8b7bff', fillOpacity: 0.5 }}
          >
            <Tooltip>
              {[p.city, p.country].filter(Boolean).join(', ') || '알 수 없음'} · {p.count}건
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
