FROM node:4.0

WORKDIR /teleboyarin

ADD package.json /teleboyarin/package.json
RUN npm install

ADD . /teleboyarin

CMD ["/teleboyarin/teleboyarin-cmd.sh"]
