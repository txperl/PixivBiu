import { useParams } from "react-router";
import SearchBar from "@/features/search/components/search-bar";
import SearchDiscovery from "@/features/search/components/search-discovery";
import SearchResults from "./results";

function SearchPage() {
    const { keyword: rawKeyword } = useParams<{ keyword?: string }>();
    const keyword = rawKeyword ?? "";

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-4 pb-7">
            <SearchBar defaultValue={keyword} autoFocus={!keyword} />
            {keyword ? <SearchResults keyword={keyword} /> : <SearchDiscovery />}
        </div>
    );
}

export default SearchPage;
