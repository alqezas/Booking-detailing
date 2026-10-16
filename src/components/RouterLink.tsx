import {forwardRef, type AnchorHTMLAttributes} from 'react';
import {Link as RRLink} from 'react-router';

/** Lets every Astryx `href` navigate inside the SPA; external URLs stay plain links. */
export const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & {href?: string}>(
  function RouterLink({href = '', ...rest}, ref) {
    if (/^(https?:|mailto:|tel:|blob:)/.test(href) || rest.download !== undefined) {
      return <a ref={ref} href={href} {...rest} />;
    }
    return <RRLink ref={ref} to={href} {...rest} />;
  },
);
