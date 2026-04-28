import AuthPanel from "@/components/auth/AuthPanel";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n";

function Home() {
    const m = useMessages();
    return (
        <div className="flex min-h-svh w-full flex-col items-center justify-center gap-3 p-6">
            <Button>{m.home_cta()}</Button>
            <AuthPanel />
        </div>
    );
}

export default Home;
