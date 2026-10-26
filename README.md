# Try-On MVP — FastFit Multi-Garment

A static, browser-based virtual try-on MVP. It supports uploading a person photo and garment reference images for **top, lower, dress, shoes, and bag**, then calls the FastFit Hugging Face Space once.

## Important limitations

- This is a prototype, not a production-ready commerce system.
- The browser sends images directly to the configured Hugging Face Space. Review that Space's privacy policy and license before use.
- The FastFit Space's API schema may mark every image parameter as required. This implementation therefore asks for all five garment images before generation. If the upstream Space changes to support optional garment slots, update `validateTryOnInputs()` in `public/assets/app.js`.
- FastFit's published license is non-commercial. Do not use it for commercial storefront activity unless you obtain permission or a suitable license from the rights holder.
- A Hugging Face token is optional for public Spaces, but can be required by a Space. If used, enter a read-scoped token. The option to remember it stores it in this browser's `localStorage`; anyone using the same browser profile may be able to access it.
- This frontend has no server-side secret storage. Do not put private API keys in the repository.
- Cross-origin requests may be blocked if the upstream Space's CORS configuration changes. For production, proxy requests through a server you control.
- Output quality depends on the person photo, clean garment images, and the upstream model. Results are not guaranteed.

## Run locally

Requires Python 3 only for serving the static files and building the sample catalog.

```bash
python3 scripts/build_catalog.py
cd public
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. In repository settings, select **Pages → GitHub Actions**.
3. The included workflow validates and builds the catalog, then deploys `public/`.
4. Optionally set the `FEED_URL` repository secret to a CSV feed with the same columns as `data/products.csv`.

## Catalog

`data/products.csv` is sample data only. Replace example product URLs and blank image URLs with real data you have permission to use. The current demo UI includes a basic catalog/selection view; the try-on flow uses the separately uploaded garment reference images to avoid relying on catalog image CORS.

## FastFit integration

- Space: `PrathamMMallya999/fastfit-tryon`
- Endpoint: `/generation_wrapper`
- Inputs: person, upper, lower, dress, shoes, bag, reference size, inference steps, guidance scale, square mask, seed, pose guidance.
- API details are centralized in `public/assets/hf.js`.
