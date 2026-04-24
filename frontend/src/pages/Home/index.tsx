import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";

function Home() {
    const m = useMessages();
    return (
        <div className="flex min-h-svh w-full items-center justify-center">
            <Button>{m.home_cta()}</Button>
        </div>
    );
}

export default Home;
