import { useState } from "react";
import DownloadFAB from "@/features/downloads/components/download-fab";
import DownloadsSheet from "@/features/downloads/components/downloads-sheet";
import SearchBar from "@/features/search/components/search-bar";
import FollowedAuthors from "@/features/users/components/followed-authors";
import HomeIllustTabs from "./components/illust-tabs";

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

    const clearSelection = () => setSelected(new Set());

    return (
        <div className="relative flex flex-col gap-6 px-7 pt-4 pb-7">
            <SearchBar />
            <h1 className="m-0 font-normal text-3xl text-foreground leading-tight">午后好，今天的画都在这儿</h1>
            <section className="grid grid-cols-[1.3fr_1fr] gap-4">
                <DownloadsSheet />
                <FollowedAuthors />
            </section>
            <HomeIllustTabs selected={selected} onToggle={toggle} onClearSelection={clearSelection} />
            <DownloadFAB selectedCount={selected.size} onDownload={() => {}} onClearSelection={clearSelection} />
        </div>
    );
}

export default Home;
