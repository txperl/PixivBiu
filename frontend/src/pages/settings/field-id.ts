// Stable DOM id for a field's control, so labels and aria-describedby can
// reference it. Dotted keys aren't valid id chars, so swap dots for dashes.
export function fieldId(key: string): string {
    return `cfg-${key.replace(/\./g, "-")}`;
}
