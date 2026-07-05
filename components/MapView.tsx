"use client";

import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapBounds, Station } from "@/lib/types";

export type MapTarget = { latitude: number; longitude: number; zoom: number; token: number };

type Props = {
  stations: Station[];
  selectedId: string | null;
  onSelect: (station: Station) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  onViewChange: (center: { latitude: number; longitude: number }, zoom: number) => void;
  initialCenter: { latitude: number; longitude: number };
  initialZoom: number;
  target: MapTarget | null;
  userLocation: { latitude: number; longitude: number } | null;
};

function markerClass(station: Station) {
  const values = [station.ai92, station.ai95, station.diesel, station.gas];
  if (values.every((value) => value === null)) return "marker-gray";
  const count = values.filter(Boolean).length;
  if (count >= 3) return "marker-green";
  if (count > 0) return "marker-amber";
  return "marker-red";
}

function iconFor(station: Station, active: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="station-marker ${markerClass(station)}" style="${active ? "transform:rotate(-45deg) scale(1.18);" : ""}"></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}

function clusterIcon(count: number) {
  const size = count > 99 ? 48 : count > 9 ? 42 : 36;
  return L.divIcon({
    className: "",
    html: `<div class="station-cluster"><span>${count > 999 ? `${Math.round(count / 100) / 10}k` : count}</span></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function StationMarkers({ stations, selectedId, onSelect }: Pick<Props, "stations" | "selectedId" | "onSelect">) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const groups = useMemo(() => {
    if (zoom >= 12) return stations.map((station) => ({ latitude: station.latitude, longitude: station.longitude, stations: [station] }));
    const cells = new Map<string, { latitude: number; longitude: number; stations: Station[] }>();
    for (const station of stations) {
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
    return [...cells.values()];
  }, [map, stations, zoom]);

  return <>{groups.map((group) => {
    if (group.stations.length === 1) {
      const station = group.stations[0];
      return <Marker key={station.id} position={[station.latitude, station.longitude]} icon={iconFor(station, selectedId === station.id)} zIndexOffset={selectedId === station.id ? 1000 : 0} eventHandlers={{ click: () => onSelect(station) }} />;
    }
    const key = `cluster-${zoom}-${group.latitude.toFixed(4)}-${group.longitude.toFixed(4)}`;
    return <Marker key={key} position={[group.latitude, group.longitude]} icon={clusterIcon(group.stations.length)} eventHandlers={{ click: () => map.flyTo([group.latitude, group.longitude], Math.min(zoom + 2, 15), { duration: 0.55 }) }} />;
  })}</>;
}

function FocusStation({ station }: { station?: Station }) {
  const map = useMap();
  useEffect(() => {
    if (!station) return;
    const target = L.latLng(station.latitude, station.longitude);
    if (map.getCenter().distanceTo(target) > 30 || map.getZoom() < 14) {
      map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.6 });
    }
  }, [map, station]);
  return null;
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

export default function MapView({ stations, selectedId, onSelect, onBoundsChange, onViewChange, initialCenter, initialZoom, target, userLocation }: Props) {
  const selected = stations.find((station) => station.id === selectedId);
  return (
    <MapContainer center={[initialCenter.latitude, initialCenter.longitude]} zoom={initialZoom} zoomControl={true} className="h-full w-full" minZoom={2}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <BoundsWatcher onChange={onBoundsChange} onViewChange={onViewChange} />
      <StationMarkers stations={stations} selectedId={selectedId} onSelect={onSelect} />
      <FocusStation station={selected} />
      <FlyToTarget target={target} />
      {userLocation && <><Circle center={[userLocation.latitude, userLocation.longitude]} radius={90} pathOptions={{ color: "#1f6b45", fillColor: "#1f6b45", fillOpacity: 0.12, weight: 1 }} /><Marker position={[userLocation.latitude, userLocation.longitude]} icon={L.divIcon({ className: "", html: '<div class="user-location-marker"><i></i></div>', iconSize: [24, 24], iconAnchor: [12, 12] })} interactive={false} /></>}
    </MapContainer>
  );
}
