import type { IconSvgElement } from "@hugeicons/react";
import type { ComponentType } from "react";
import { FilterIcon, TriangleIcon } from "@/lib/icons";
import { FILTER_ID } from "./items/filter";
import { QUICK_ACTION_ID } from "./items/quick-action";
import FilterPanel from "./panels/filter-panel";
import QuickActionPanel from "./panels/quick-action-panel";

export type ActivityItemId = typeof QUICK_ACTION_ID | typeof FILTER_ID;

export type ActivityItemDef = {
    id: ActivityItemId;
    icon: IconSvgElement;
    label: string;
    Panel: ComponentType;
};

export const ITEM_DEFS: readonly ActivityItemDef[] = [
    { id: FILTER_ID, icon: FilterIcon, label: "Filter", Panel: FilterPanel },
    { id: QUICK_ACTION_ID, icon: TriangleIcon, label: "Quick Action", Panel: QuickActionPanel },
];
