# Trivy for the image scan in image.yml: the one place for its version,
# watched by Dependabot (docker ecosystem). Not built; the workflow runs it.
FROM aquasec/trivy:0.76.1
