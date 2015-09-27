FROM node:latest
MAINTAINER Dmitry Ustalov
WORKDIR /teleboyarin
COPY package.json /teleboyarin/package.json
RUN npm install && mkdir log && chown -R nobody:nogroup log
COPY . /teleboyarin
USER nobody
CMD ["/teleboyarin/teleboyarin-cmd.sh"]
