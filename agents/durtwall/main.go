package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = fmt.Fprint(writer, "DurtWall Agent Running")
	})

	address := ":" + port
	log.Printf("DurtWall agent listening on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(address, nil))
}
