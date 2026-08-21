FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/durtwall .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/durtwall /durtwall
COPY config.yaml rules.conf /etc/durtwall/
EXPOSE 8080
ENTRYPOINT ["/durtwall", "-config", "/etc/durtwall/config.yaml"]