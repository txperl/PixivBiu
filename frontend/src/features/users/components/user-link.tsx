import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

type UserLinkProps = {
    userId: number;
    className?: string;
    children: ReactNode;
};

function UserLink({ userId, className, children }: UserLinkProps) {
    return (
        <Link
            to={`/user/${userId}`}
            onClick={(e) => e.stopPropagation()}
            className={cn("hover:text-foreground", className)}
        >
            {children}
        </Link>
    );
}

export default UserLink;
