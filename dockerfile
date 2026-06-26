# 1. Usamos una imagen liviana de Node.js basada en Alpine Linux
FROM node:18-alpine

# 2. Creamos y definimos el directorio de trabajo dentro del contenedor
WORKDIR /app

# 3. Copiamos solo los archivos de dependencias primero para aprovechar la caché de Docker
COPY package*.json ./

# 4. Instalamos solo las dependencias de producción (evitamos instalar nodemon en AWS)
RUN npm install --production

# 5. Copiamos el resto del código fuente del proyecto al contenedor
COPY . .

# 6. Exponemos el puerto en el que corre Express por defecto
EXPOSE 8081

# 7. Comando para arrancar la aplicación en modo producción
CMD ["node", "server.js"]