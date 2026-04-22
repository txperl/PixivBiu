import { Button } from "@/components/ui/button";
import { useDynamicTheme } from "./lib/theme/use-dynamic-theme";

function App() {
    useDynamicTheme();

    return (
        <div className="flex min-h-svh flex-col items-center justify-center">
            <Button>Click me</Button>
        </div>
    );
}

export default App;
