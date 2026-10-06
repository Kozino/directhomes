# Direct Homes: web app (frontend)
Static single-page app (plain HTML, CSS and JavaScript). No build step.

Files: `index.html`, `style.css`, `config.js` (API URL), `app.js` (search, auth, dashboards), `pages.js` (landing, onboarding, properties, tokens, admin), `forms.js` (modal forms, edit/delete, ticket page), `admin.js` (the full admin area), `netlify.toml` (proxy to the API).

## Run locally
1. Start the backend on port 4000.
2. Set `window.API_URL = "http://localhost:4000"` in `config.js`, and `WEB_ORIGIN=http://localhost:3000` in the backend `.env`.
3. `npx serve -l 3000 .`

## Deploy on Netlify
New site from Git, **Base directory = `frontend`**, build command empty, publish directory `.`.
Edit `netlify.toml` and replace `YOUR-API` with your Render hostname. Leave `config.js` as it is when using that proxy.
