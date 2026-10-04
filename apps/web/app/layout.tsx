import type { ReactNode } from "react";
import "./styles.css";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><header className="site-header"><a href="/">Clone Market</a><span>Public evidence. Private imports.</span></header><main>{children}</main></body></html>;
}
