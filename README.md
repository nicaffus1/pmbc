# PMBC — Church Community PWA

Starter foundation for PMBC's future multi-member church app, to be hosted by GitHub Pages and connected to Firebase.

## Current foundation
- Mobile-first Home, Prayer, Serve, and More navigation
- App manifest, starter offline service worker, and icon paths
- Placeholder sample content clearly identified
- **No authentication, Firestore, admin approvals, live sign-ups, privacy rules, reminders, or push notifications yet. Do not submit real member or prayer information.**

## Asset upload still required
The GitHub connector uploaded the text application files but does not support attaching the local binary images directly. Upload these four files from the provided PMBC-starter.zip to the `assets/` folder:
- `dove-source.jpg` (original dove art)
- `icon-180.png`
- `icon-192.png`
- `icon-512.png`

The generated PNG icons are composites of the original source image, not regenerated or reillustrated. The app will not display its intended branding until these files exist. The service worker currently caches the available page files so offline mode can start functioning before image upload.

## Hosting
After all images have been uploaded, open repository Settings → Pages → Deploy from a branch → `main` → `/ (root)` and Save. Visit the resulting HTTPS Pages link on a phone to add PMBC to its Home Screen.

## Next major development stage
Firebase Authentication, Firestore security rules, first-admin setup, account approval, privacy-sensitive prayer requests, ministry-scoped roles, volunteer positions and shifts, approvals, assignments and cancellations. Timed push reminders require a separately configured server-side scheduling/delivery mechanism and may have costs.
