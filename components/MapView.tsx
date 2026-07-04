"use client";

import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";
import type { MapBounds, Station } from "@/lib/types";

type Props = {
  stations: Station[];
  selectedId: string | null;
  onSelect: (station: Station) => void;
  onBoundsChange: (bounds: MapBounds) => void;
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

function FocusStation({ station }: { station?: Station }) {
  const map = useMap();
  useEffect(() => {
    if (station) map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, station]);
  return null;
}

function BoundsWatcher({ onChange }: { onChange: (bounds: MapBounds) => void }) {
  const map = useMapEvents({
    moveend: () => emitBounds(),
    zoomend: () => emitBounds(),
  });

  const emitBounds = () => {
    const bounds = map.getBounds();
    onChange({
      west: Number(bounds.getWest().toFixed(5)),
      south: Number(bounds.getSouth().toFixed(5)),
      east: Number(bounds.getEast().toFixed(5)),
      north: Number(bounds.getNorth().toFixed(5)),
    });
  };

  useEffect(() => emitBounds(), [map]);
  return null;
}

export default function MapView({ stations, selectedId, onSelect, onBoundsChange }: Props) {
  const selected = stations.find((station) => station.id === selectedId);
  return (
    <MapContainer center={[55.7558, 37.6173]} zoom={11} zoomControl={true} className="h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <BoundsWatcher onChange={onBoundsChange} />
      {stations.map((station) => (
        <Marker
          key={station.id}
          position={[station.latitude, station.longitude]}
          icon={iconFor(station, selectedId === station.id)}
          eventHandlers={{ click: () => onSelect(station) }}
        />
      ))}
      <FocusStation station={selected} />
    </MapContainer>
  );
}
