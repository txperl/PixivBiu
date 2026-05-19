import type { IconSvgElement } from "@hugeicons/react";
import type { ComponentType } from "react";
import { FilterIcon } from "@/lib/icons";
import { FILTER_ID } from "./items/filter";
import FilterPanel from "./panels/filter-panel";

export type ActivityItemId = typeof FILTER_ID;

export type ActivityItemDef = {
    id: ActivityItemId;
    icon: IconSvgElement;
    label: string;
    Panel: ComponentType;
};

export const ITEM_DEFS: readonly ActivityItemDef[] = [
    { id: FILTER_ID, icon: FilterIcon, label: "Filter", Panel: FilterPanel },
];
