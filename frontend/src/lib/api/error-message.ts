import type { components } from "./schema.gen";

type ApiError = components["schemas"]["Error"];

const MESSAGES: Record<string, string> = {
    unauthenticated: "请先登录 Pixiv 账号",
    not_found: "未找到对应资源",
    rate_limited: "请求过于频繁，请稍后再试",
};

export function apiErrorMessage(error: ApiError): string {
    return MESSAGES[error.code] ?? error.message;
}
