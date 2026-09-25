// Landing page bootstrap: redirects already-shared audience links/QRs
// (`/?session=<id>`) straight to the viewer. See landing-core.js for the
// pure, unit-tested redirect logic.

import { viewerRedirect } from "./landing-core.js";

const redirect = viewerRedirect(location.search);
if (redirect) location.replace(redirect);
