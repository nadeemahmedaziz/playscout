# PlayScout — 100% Free Edition

Fast static dashboard on GitHub Pages with a scheduled Google Play scanner on GitHub Actions. The scanner runs every six hours and can also be started manually from the Actions tab.

## Activate

1. Create a public GitHub repository named `playscout`.
2. Upload every file and folder from this package to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch **main**, folder **/docs**, and click **Save**.
6. Open **Actions → Update Google Play game index → Run workflow** for the first scan.

The site URL will be `https://YOUR-USERNAME.github.io/playscout/`.

## Optional custom subdomain

In GitHub Pages settings, set `playscout.devsoftstudio.com` as the custom domain. In Hostinger DNS add a CNAME record with name `playscout` pointing to `YOUR-USERNAME.github.io`.

## Accuracy

Google Play has no complete public release-by-date directory. PlayScout scans ranked game collections, verifies every discovered app's initial release date, and keeps accumulating its index. Unranked apps can be missed.
