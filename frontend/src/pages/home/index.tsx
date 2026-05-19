import { useCallback, useState } from "react";
import RecentDownloads from "@/features/downloads/components/recent-downloads";
import SearchBar from "@/features/search/components/search-bar";
import FollowedAuthors from "@/features/users/components/followed-authors";
import HomeIllustTabs, { type TabId } from "./components/illust-tabs";

function Home() {
    const [activeTab, setActiveTab] = useState<TabId>("for-you");

    const handleViewFollow = useCallback(() => {
        setActiveTab("follow");
    }, []);

    return (
        <div className="relative flex flex-col gap-6 px-7 pt-4 pb-7">
            <SearchBar />
            <h1 className="m-0 font-normal text-3xl text-foreground leading-tight">午后好，今天的画都在这儿</h1>
            <section className="grid grid-cols-[1.3fr_1fr] items-start gap-4">
                <RecentDownloads />
                <FollowedAuthors onView={handleViewFollow} />
            </section>
            <HomeIllustTabs activeTab={activeTab} onActiveTabChange={setActiveTab} />
        </div>
    );
}

export default Home;
