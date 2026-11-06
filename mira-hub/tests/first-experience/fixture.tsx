import { createRoot } from "react-dom/client";
import Signup from "../../src/app/signup/page";
import Pending from "../../src/app/(hub)/pending-approval/page";
import Upgrade from "../../src/app/(hub)/upgrade/page";
import Quickstart from "../../src/app/quickstart/page";
import Login from "../../src/app/login/login-form";
const pages = { "/signup": Signup, "/pending-approval": Pending, "/upgrade": Upgrade, "/quickstart": Quickstart, "/login": Login };
const Page = pages[window.location.pathname as keyof typeof pages] ?? Pending;
createRoot(document.getElementById("root")!).render(<Page />);
