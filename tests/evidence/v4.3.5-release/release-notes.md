# Local Suite v4.3.5

Local Suite v4.3.5 adds **Optical Transfer Beta Test 1** as the 106th manifest tool and fourth Beta Tools card.

The separate page packages the selected H66-R2 faster carrier:

- QR V37 with 2,563-byte frames
- ECC L and fixed mask 4
- approximately 30 presentations per second
- sender precompute ring depth 3
- four receiver workers
- processor capture with calibrated fixed ROI
- ZXing fast global-histogram decoding
- adaptive H40 residual recovery
- post-SHA lifecycle closure

The selected package has a gross carrier ceiling of 76,890 B/s. Its strict 1 MiB physical result was 65,919.16 B/s. This is not an unconstrained performance maximum; browser scheduling, camera optics/capture, decode yield, CPU, LT overhead, and thermal state remain production limits.

Stable `optical.html` and the existing `optical-beta.html` remain byte-for-byte unchanged. The release contains 106 tools plus the hub (107 generated HTML pages) and a 111-entry PWA precache.
