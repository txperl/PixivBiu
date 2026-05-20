import DiscoveryRecent from "./discovery-recent";
import DiscoveryTrending from "./discovery-trending";

function SearchDiscovery() {
    return (
        <div className="flex flex-col gap-6 pt-2">
            <DiscoveryRecent />
            <DiscoveryTrending />
        </div>
    );
}

export default SearchDiscovery;
