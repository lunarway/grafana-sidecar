FROM node:20.1.0-alpine

COPY package.json package-lock.json ./
RUN npm install .

COPY . .

ENTRYPOINT [ "node", "index.js" ]
CMD [ "watch" ]