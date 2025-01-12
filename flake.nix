{
  description = "A basic flake with a shell";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        username = "admin";
        passwordHash =
          "$apr1$bhZ6EAAr$E8cv5p/2RUBrxLZD.9Jpi."; # Replace with your hash

        nginxConfig = pkgs.writeText "nginx.conf" ''
          worker_processes auto;
          daemon off;

          events {
            worker_connections 1024;
          }

          http {
            include ${pkgs.nginx}/conf/mime.types;
            
            server {
              listen 8080;
              
              location / {
                auth_basic "Restricted Content";
                auth_basic_user_file /etc/nginx/htpasswd;
                
                root /app;
                index index.html;
                try_files $uri $uri/ /index.html;
              }
            }
          }
        '';

        htpasswd = pkgs.writeText "htpasswd" ''
          ${username}:${passwordHash}
        '';
      in {
        packages = rec {
          react = pkgs.buildNpmPackage {
            pname = "mast-react";
            version = "0.0.1";
            src = ./mast-react-vite;

            npmDepsHash = "sha256-oqq55MEzXGEiF9UW7rZFyQrkyTPrUEkh2enZmbbZ7Ks=";
            buildInputs = with pkgs; [ nodejs typescript ];
            nativeBuildInputs = with pkgs; [ nodejs ];

            # npmWorkspace = ./mast-react-vite;
            npmBuildScript = "build";
            installPhase = ''
              mkdir -p $out
              cp -r dist $out/
            '';
          };
          react-server = pkgs.dockerTools.buildImage {
            name = "react-server";
            tag = "latest";

            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [
                pkgs.nginx
                react
                (pkgs.writeScriptBin "start-server" ''
                  #!/usr/bin/env bash 

                  # Create necessary directories
                  mkdir -p /etc/nginx
                  cp ${htpasswd} /etc/nginx/htpasswd

                  # Create app directory and copy built files
                  mkdir -p /app
                  cp -r ${react}/* /app/

                  # Start nginx
                  ${pkgs.nginx}/bin/nginx -c ${nginxConfig}
                '')
              ];
              pathsToLink = [ "/bin" ];
            };

            config = {
              Cmd = [ "/bin/start-server" ];
              ExposedPorts = { "8080/tcp" = { }; };
            };
          };
        };
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [ bun ];

          # TODO:
          # Shell Aliases don't work for direnv because they're not shell portable
          # Find an alternative to this
          shellHook = ''
            alias start-dev='npm run dev'
            alias build-dev='npm run build'
            alias clean-dev='rm -rf dist node_modules'
            alias ws-server='go run ./server/main.go'
            alias gen-pass='openssl passwd -apr1 '

            echo "System: ${system}"
            echo "Available commands:"
            echo "  start-dev  - Start Vite dev server"
            echo "  build-dev  - Build the application"
            echo "  clean-dev  - Clean build artifacts"
            echo "  ws-server  - Run the websocket server"
            echo "  gen-pass   - Generate a basic_auth password"
          '';
        };
      });
}
