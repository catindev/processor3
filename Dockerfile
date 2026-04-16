FROM harbor.online.tkbbank.ru/library/node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src        ./src
COPY ui-dist    ./ui-dist
COPY artifacts  ./artifacts

ENV PORT=3000 \
    PROCESSOR_DEFAULT_FLOW_ID=beneficiary.registration.v3 \
    PROCESSOR_DEFAULT_FLOW_VERSION=1.0.0

EXPOSE 3000
CMD ["npm", "start"]
