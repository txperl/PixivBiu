import { Navigate, useParams } from "react-router";
import { useAuth } from "@/features/auth";
import { normalizeTab } from "@/pages/user/tabs";

function MeRedirect() {
    const { status } = useAuth();
    const { tab: rawTab } = useParams<{ tab?: string }>();

    if (status === null) return null;
    if (!status.authenticated || !status.user_id) return <Navigate replace to="/" />;

    const tab = normalizeTab(rawTab);

    return <Navigate replace to={`/user/${status.user_id}?tab=${tab}`} />;
}

export default MeRedirect;
