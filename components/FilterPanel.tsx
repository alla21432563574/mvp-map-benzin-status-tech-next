"use client";

import { Check, ChevronDown, RotateCcw } from "lucide-react";
import { useState } from "react";
import { brandOptions } from "@/lib/map-utils";
import { filterFuelKeys, filterFuelLabels, type FilterFuelKey } from "@/lib/types";

type Props = {
  fuels: Set<FilterFuelKey>;
  brands: Set<string>;
  onFuelsChange: (value: Set<FilterFuelKey>) => void;
  onBrandsChange: (value: Set<string>) => void;
};

function Toggle({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return <button onClick={onClick} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold transition ${checked ? "border-forest bg-forest text-white dark:border-lime dark:bg-lime dark:text-ink" : "border-ink/10 bg-white text-ink/65 hover:border-forest/30 dark:border-white/10 dark:bg-white/5 dark:text-white/65 dark:hover:border-lime/40"}`}><span className={`grid h-4 w-4 place-items-center rounded-[5px] border ${checked ? "border-lime bg-lime text-ink dark:border-ink" : "border-ink/20 dark:border-white/20"}`}>{checked && <Check size={11} strokeWidth={3} />}</span>{label}</button>;
}

export default function FilterPanel({ fuels, brands, onFuelsChange, onBrandsChange }: Props) {
  const [open, setOpen] = useState(false);
  const activeCount = fuels.size + brands.size;
  const toggleFuel = (fuel: FilterFuelKey) => {
    const next = new Set(fuels);
    if (next.has(fuel)) next.delete(fuel);
    else next.add(fuel);
    onFuelsChange(next);
  };
  const toggleBrand = (brand: string) => {
    const next = new Set(brands);
    if (next.has(brand)) next.delete(brand);
    else next.add(brand);
    onBrandsChange(next);
  };
  const reset = () => { onFuelsChange(new Set()); onBrandsChange(new Set()); };

  return (
    <div className="border-b border-ink/8 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#19241e] lg:px-5">
      <button onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between text-sm font-bold">
        <span>Фильтры {activeCount > 0 && <i className="ml-1 rounded-full bg-lime px-2 py-0.5 not-italic text-[11px] text-ink">{activeCount}</i>}</span>
        <ChevronDown size={17} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "mt-4 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"} grid transition-all duration-300`}>
        <div className="overflow-hidden">
          <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-ink/40 dark:text-white/40">Топливо</p>{activeCount > 0 && <button onClick={reset} className="flex items-center gap-1 text-[11px] font-bold text-forest dark:text-lime"><RotateCcw size={11} />Сбросить</button>}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {filterFuelKeys.map((fuel) => <Toggle key={fuel} checked={fuels.has(fuel)} label={filterFuelLabels[fuel]} onClick={() => toggleFuel(fuel)} />)}
          </div>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[.14em] text-ink/40 dark:text-white/40">Бренд</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Toggle checked={brands.size === 0} label="Все" onClick={() => onBrandsChange(new Set())} />
            {brandOptions.map((brand) => <Toggle key={brand.id} checked={brands.has(brand.id)} label={brand.label} onClick={() => toggleBrand(brand.id)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
