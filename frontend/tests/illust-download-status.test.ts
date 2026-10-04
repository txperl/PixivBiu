import { describe, expect, test } from "bun:test";
import type { DownloadJob, DownloadTask } from "../src/features/downloads/api";
import { deriveIllustDownloadStatus } from "../src/features/downloads/use-illust-download-status";

const job = (status: DownloadJob["status"], sizes: [number, number][]): DownloadJob =>
    ({
        id: "a",
        illust_id: 1,
        status,
        tasks: sizes.map(
            ([downloaded_bytes, size_bytes], i) => ({ id: `t${i}`, downloaded_bytes, size_bytes }) as DownloadTask,
        ),
    }) as DownloadJob;

describe("illust download status", () => {
    test("no job is idle", () => {
        expect(deriveIllustDownloadStatus(undefined)).toEqual({ job: null, active: false, percent: null });
    });

    test("active jobs report the byte ratio across tasks", () => {
        const status = deriveIllustDownloadStatus(
            job("running", [
                [50, 100],
                [25, 100],
            ]),
        );
        expect(status.active).toBe(true);
        expect(status.percent).toBe(0.375);
    });

    test("an unknown task size or no tasks is indeterminate", () => {
        expect(
            deriveIllustDownloadStatus(
                job("running", [
                    [50, 100],
                    [0, 0],
                ]),
            ).percent,
        ).toBeNull();
        expect(deriveIllustDownloadStatus(job("queued", [])).percent).toBeNull();
        expect(deriveIllustDownloadStatus(job("queued", [])).active).toBe(true);
    });

    test("terminal jobs are inactive without a percentage", () => {
        expect(deriveIllustDownloadStatus(job("completed", [[100, 100]]))).toMatchObject({
            active: false,
            percent: null,
        });
    });
});
