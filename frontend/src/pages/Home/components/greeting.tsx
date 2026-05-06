import StatCard from "@/components/stat-card";

function Greeting() {
    return (
        <section>
            <div className="mb-4 flex items-end gap-3.5">
                <div>
                    <h1 className="m-0 font-normal text-3xl text-foreground leading-tight">午后好，今天的画都在这儿</h1>
                    <p className="mt-2 mb-0 text-muted-foreground text-sm">
                        基于你关注的 12 位作者 · 最近 7 天新增 <span className="font-medium text-foreground">48</span>{" "}
                        件 · 10 月 21 日
                    </p>
                </div>
                <div className="flex-1" />
                <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-muted-foreground text-xs">
                    <span className="size-2 rounded-full bg-primary" />
                    同步于 2 分钟前
                </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
                <StatCard label="关注作者" value="12" delta="+2 本周" />
                <StatCard label="收藏作品" value="284" delta="+18 本周" />
                <StatCard label="已下载" value="1,420" delta="6.8 GB" mono />
                <StatCard label="下载中" value="2" delta="19.2 MB · 49%" accent />
            </div>
        </section>
    );
}

export default Greeting;
