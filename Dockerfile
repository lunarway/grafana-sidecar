FROM node:21.7.2-alpine

COPY package.json package-lock.json ./
RUN npm install .

COPY . .

ENTRYPOINT [ "node", "index.js" ]
CMD [ "watch" ]