import type { IconSvgElement } from "@hugeicons/react";
import type { ComponentType } from "react";
import { TriangleIcon } from "@/lib/icons";
import { QUICK_ACTION_ID } from "./items/quick-action";
import QuickActionPanel from "./panels/quick-action-panel";

export type ActivityItemId = typeof QUICK_ACTION_ID;

export type ActivityItemDef = {
    id: ActivityItemId;
    icon: IconSvgElement;
    label: string;
    Panel: ComponentType;
};

export const ITEM_DEFS: readonly ActivityItemDef[] = [
    { id: QUICK_ACTION_ID, icon: TriangleIcon, label: "Quick Action", Panel: QuickActionPanel },
];
