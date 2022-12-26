FROM node:19.3.0-alpine

COPY package.json package-lock.json ./
RUN npm install .

COPY . .

ENTRYPOINT [ "node", "index.js" ]
CMD [ "watch" ]