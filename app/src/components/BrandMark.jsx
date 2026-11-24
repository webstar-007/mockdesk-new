import { useSite } from '../lib/site.js';

// The logo box next to the site name. Shows the uploaded logo, or the built-in tick.
export default function BrandMark() {
  const site = useSite();
  return site.logoUrl
    ? <span className="brand-mark has-logo" aria-hidden="true"><img src={site.logoUrl} alt="" /></span>
    : <span className="brand-mark" aria-hidden="true">✓</span>;
}
