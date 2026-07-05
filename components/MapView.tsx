"use client";

import L from "leaflet";
import { AttributionControl, Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import { stationDisplayStatus } from "@/lib/map-utils";
import type { MapBounds, Station } from "@/lib/types";

export type MapTarget = { latitude: number; longitude: number; zoom: number; token: number };

type Props = {
  stations: Station[];
  selectedId: string | null;
  recommendedId: string | null;
  onSelect: (station: Station) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  onViewChange: (center: { latitude: number; longitude: number }, zoom: number) => void;
  initialCenter: { latitude: number; longitude: number };
  initialZoom: number;
  target: MapTarget | null;
  userLocation: { latitude: number; longitude: number } | null;
};

function markerClass(station: Station) {
  const status = stationDisplayStatus(station).kind;
  return markerClassForStatus(status);
}

function markerClassForStatus(status: "available" | "partial" | "unavailable" | "unknown") {
  if (status === "available") return "marker-green";
  if (status === "partial") return "marker-amber";
  if (status === "unavailable") return "marker-red";
  return "marker-gray";
}

function iconFor(station: Station, active: boolean, recommended: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="station-marker ${markerClass(station)}${recommended ? " marker-recommended" : ""}" style="${active && !recommended ? "transform:rotate(-45deg) scale(1.18);" : ""}"></div>`,
    iconSize: recommended ? [42, 42] : [34, 34],
    iconAnchor: recommended ? [21, 42] : [17, 34],
  });
}

function clusterStatus(stations: Station[]) {
  let hasPartial = false;
  let hasUnavailable = false;
  for (const station of stations) {
    const status = stationDisplayStatus(station).kind;
    if (status === "available") return "available";
    if (status === "partial") hasPartial = true;
    if (status === "unavailable") hasUnavailable = true;
  }
  if (hasPartial) return "partial";
  if (hasUnavailable) return "unavailable";
  return "unknown";
}

function clusterIcon(count: number, status: "available" | "partial" | "unavailable" | "unknown") {
  const size = count > 99 ? 48 : count > 9 ? 42 : 36;
  return L.divIcon({
    className: "",
    html: `<div class="station-cluster ${markerClassForStatus(status)}"><span>${count > 999 ? `${Math.round(count / 100) / 10}k` : count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function StationMarkers({ stations, selectedId, recommendedId, onSelect }: Pick<Props, "stations" | "selectedId" | "recommendedId" | "onSelect">) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const groups = useMemo(() => {
    if (zoom >= 12) return stations.map((station) => ({ latitude: station.latitude, longitude: station.longitude, stations: [station] }));
    const cells = new Map<string, { latitude: number; longitude: number; stations: Station[] }>();
    for (const station of stations) {
      if (station.id === recommendedId) continue;
      const point = map.project([station.latitude, station.longitude], zoom);
      const key = `${Math.floor(point.x / 58)}:${Math.floor(point.y / 58)}`;
      const group = cells.get(key);
      if (group) {
        const count = group.stations.length;
        group.latitude = (group.latitude * count + station.latitude) / (count + 1);
        group.longitude = (group.longitude * count + station.longitude) / (count + 1);
        group.stations.push(station);
      } else {
        cells.set(key, { latitude: station.latitude, longitude: station.longitude, stations: [station] });
      }
    }
    const recommended = stations.find((station) => station.id === recommendedId);
    return recommended ? [{ latitude: recommended.latitude, longitude: recommended.longitude, stations: [recommended] }, ...cells.values()] : [...cells.values()];
  }, [map, recommendedId, stations, zoom]);

  return <>{groups.map((group) => {
    if (group.stations.length === 1) {
      const station = group.stations[0];
      const recommended = recommendedId === station.id;
      return <Marker key={station.id} position={[station.latitude, station.longitude]} icon={iconFor(station, selectedId === station.id, recommended)} zIndexOffset={selectedId === station.id ? 1000 : recommended ? 900 : 0} eventHandlers={{ click: () => onSelect(station) }} />;
    }
    const key = `cluster-${zoom}-${group.latitude.toFixed(4)}-${group.longitude.toFixed(4)}`;
    return <Marker key={key} position={[group.latitude, group.longitude]} icon={clusterIcon(group.stations.length, clusterStatus(group.stations))} eventHandlers={{ click: () => map.flyTo([group.latitude, group.longitude], Math.min(zoom + 2, 15), { duration: 0.55 }) }} />;
  })}</>;
}

function FlyToTarget({ target }: { target: MapTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.latitude, target.longitude], target.zoom, { duration: 0.75 });
  }, [map, target]);
  return null;
}

function BoundsWatcher({ onChange, onViewChange }: { onChange: (bounds: MapBounds) => void; onViewChange: Props["onViewChange"] }) {
  const map = useMap();
  const emitBounds = useCallback(() => {
    const bounds = map.getBounds();
    const center = map.getCenter();
    onChange({
      west: Number(bounds.getWest().toFixed(5)),
      south: Number(bounds.getSouth().toFixed(5)),
      east: Number(bounds.getEast().toFixed(5)),
      north: Number(bounds.getNorth().toFixed(5)),
    });
    onViewChange({ latitude: center.lat, longitude: center.lng }, map.getZoom());
  }, [map, onChange, onViewChange]);
  useMapEvents({
    moveend: () => emitBounds(),
  });

  useEffect(() => emitBounds(), [emitBounds]);
  return null;
}

export default function MapView({ stations, selectedId, recommendedId, onSelect, onBoundsChange, onViewChange, initialCenter, initialZoom, target, userLocation }: Props) {
  return (
    <MapContainer center={[initialCenter.latitude, initialCenter.longitude]} zoom={initialZoom} zoomControl={true} attributionControl={false} className="h-full w-full" minZoom={2}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <AttributionControl prefix='<a href="https://leafletjs.com/" title="Leaflet">Leaflet</a>' position="bottomright" />
      <BoundsWatcher onChange={onBoundsChange} onViewChange={onViewChange} />
      <StationMarkers stations={stations} selectedId={selectedId} recommendedId={recommendedId} onSelect={onSelect} />
      <FlyToTarget target={target} />
      {userLocation && <><Circle center={[userLocation.latitude, userLocation.longitude]} radius={90} pathOptions={{ color: "#1f6b45", fillColor: "#1f6b45", fillOpacity: 0.12, weight: 1 }} /><Marker position={[userLocation.latitude, userLocation.longitude]} icon={L.divIcon({ className: "", html: '<div class="user-location-marker"><i></i></div>', iconSize: [24, 24], iconAnchor: [12, 12] })} interactive={false} /></>}
    </MapContainer>
  );
}
