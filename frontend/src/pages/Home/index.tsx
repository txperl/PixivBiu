import { useState } from "react";
import { PB_WORKS } from "./mock-data";
import DownloadsSheet from "./sections/DownloadsSheet";
import FollowedAuthors from "./sections/FollowedAuthors";
import HomeFAB from "./sections/HomeFAB";
import TopBar from "./sections/TopBar";
import WorkGrid from "./sections/WorkGrid";

function Home() {
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const toggle = (id: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const works = PB_WORKS.slice(0, 15);

    return (
        <div className="relative flex flex-col gap-6 px-7 pt-4 pb-7">
            <TopBar selectedCount={selected.size} onClearSelection={() => setSelected(new Set())} />
            <h1 className="m-0 font-normal text-3xl text-foreground leading-tight">午后好，今天的画都在这儿</h1>
            <section className="grid grid-cols-[1.3fr_1fr] gap-4">
                <DownloadsSheet />
                <FollowedAuthors />
            </section>
            <WorkGrid works={works} selected={selected} onToggle={toggle} />
            <HomeFAB
                selectedCount={selected.size}
                onDownload={() => {}}
                onClearSelection={() => setSelected(new Set())}
            />
        </div>
    );
}

export default Home;
